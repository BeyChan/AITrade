"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type StepKey = "overview" | "sourcing" | "content" | "channels" | "report";

type CaseStepperProps = {
  caseId: string;
  hasCostModel?: boolean;
  hasSupplierSelection?: boolean;
  hasApprovedContent?: boolean;
  selectedSupplierName?: string | null;
  status?: string;
};

export function CaseStepper({
  caseId,
  hasCostModel = true,
  hasSupplierSelection = false,
  hasApprovedContent = false,
  selectedSupplierName,
  status,
}: CaseStepperProps) {
  const pathname = usePathname();
  const isTerminated = status === "archived" || status === "rejected";

  const steps: Array<{
    key: StepKey;
    label: string;
    subLabel: string;
    href: string;
    isCompleted: boolean;
    isActive: boolean;
    isLocked: boolean;
  }> = [
    {
      key: "overview",
      label: "1. 财务与成本",
      subLabel: hasCostModel ? "模型已建" : "待建模型",
      href: `/cases/${caseId}`,
      isCompleted: Boolean(hasCostModel),
      isActive: pathname === `/cases/${caseId}`,
      isLocked: false,
    },
    {
      key: "sourcing",
      label: "2. 1688 询价定标",
      subLabel: hasSupplierSelection ? (selectedSupplierName ? `已定标: ${selectedSupplierName}` : "已完成定标") : "待定标",
      href: `/cases/${caseId}/sourcing`,
      isCompleted: Boolean(hasSupplierSelection),
      isActive: pathname.startsWith(`/cases/${caseId}/sourcing`),
      isLocked: isTerminated,
    },
    {
      key: "content",
      label: "3. 内容与预检",
      subLabel: hasApprovedContent ? "预检通过" : hasSupplierSelection ? "制作中" : "需先定标",
      href: `/cases/${caseId}/content`,
      isCompleted: Boolean(hasApprovedContent),
      isActive: pathname.startsWith(`/cases/${caseId}/content`),
      isLocked: !hasSupplierSelection && !hasApprovedContent,
    },
    {
      key: "channels",
      label: "4. 多渠道上市",
      subLabel: "店铺发布矩阵",
      href: `/cases/${caseId}/channels`,
      isCompleted: false,
      isActive: pathname.startsWith(`/cases/${caseId}/channels`),
      isLocked: !hasSupplierSelection,
    },
    {
      key: "report",
      label: "5. 决策战报",
      subLabel: "A4 打印 / 导出",
      href: `/cases/${caseId}/report`,
      isCompleted: Boolean(hasSupplierSelection && hasCostModel),
      isActive: pathname.startsWith(`/cases/${caseId}/report`),
      isLocked: false,
    },
  ];

  return (
    <nav className="case-stepper" aria-label="商品生命周期阶段向导">
      <div className="case-stepper-track">
        {steps.map((step, idx) => {
          const content = (
            <div className="case-step-content">
              <span className="case-step-indicator">
                {step.isCompleted ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <span className="case-step-dot" />
                )}
              </span>
              <div className="case-step-text">
                <strong className="case-step-title">{step.label}</strong>
                <small className="case-step-sub">{step.subLabel}</small>
              </div>
            </div>
          );

          const className = [
            "case-step-item",
            step.isActive ? "active" : "",
            step.isCompleted ? "completed" : "",
            step.isLocked ? "locked" : "",
          ].filter(Boolean).join(" ");

          return (
            <div key={step.key} className={className}>
              {step.isLocked ? (
                <div className="case-step-link disabled" title="需完成前置步骤解锁">
                  {content}
                </div>
              ) : (
                <Link href={step.href} className="case-step-link">
                  {content}
                </Link>
              )}
              {idx < steps.length - 1 && <div className="case-step-connector" aria-hidden="true" />}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
