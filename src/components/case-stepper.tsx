"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { deriveCaseStage, type CaseStageInput } from "@/lib/case-stage";

type CaseStepperProps = CaseStageInput & {
  reportId?: string | null;
  selectedSupplierName?: string | null;
};

export function CaseStepper(props: CaseStepperProps) {
  const pathname = usePathname();
  const stage = deriveCaseStage(props);
  const { caseId, reportId, selectedSupplierName, status } = props;
  const isTerminated = status === "archived" || status === "rejected";

  const steps = [
    {
      key: "stage1",
      number: "1",
      name: "利润与合规",
      subText: stage.stepProgress.financialReview ? "成本模型已建" : "待测算利润",
      href: `/cases/${caseId}`,
      isCompleted: stage.stepProgress.financialReview,
      isActive: pathname === `/cases/${caseId}`,
      isLocked: false,
    },
    {
      key: "stage2",
      number: "2",
      name: "寻源与打样",
      subText: stage.stepProgress.sourcingQuotes ? `已有 ${props.quoteCount ?? 0} 份报价` : "录入报价与打样",
      href: `/cases/${caseId}/sourcing`,
      isCompleted: stage.stepProgress.sourcingQuotes,
      isActive: pathname.startsWith(`/cases/${caseId}/sourcing`) && !stage.stepProgress.supplierAwarded,
      isLocked: isTerminated,
    },
    {
      key: "stage3",
      number: "3",
      name: "财务定标",
      subText: stage.stepProgress.supplierAwarded
        ? (selectedSupplierName ? `已定标: ${selectedSupplierName}` : "已核准定标")
        : "多厂对比定标",
      href: `/cases/${caseId}/sourcing`,
      isCompleted: stage.stepProgress.supplierAwarded,
      isActive: pathname.startsWith(`/cases/${caseId}/sourcing`) && stage.stepProgress.supplierAwarded,
      isLocked: isTerminated,
    },
    {
      key: "stage4",
      number: "4",
      name: "文案与视觉",
      subText: stage.stepProgress.contentApproved ? "内容已终审" : "五点 / 货架 / 生图",
      href: `/cases/${caseId}/content`,
      isCompleted: stage.stepProgress.contentApproved,
      isActive: pathname.startsWith(`/cases/${caseId}/content`),
      isLocked: isTerminated,
    },
    {
      key: "stage5",
      number: "5",
      name: "上架就绪",
      subText: stage.stepProgress.contentApproved ? "Flat File / ZIP 导出" : "待完成文案与主图",
      href: `/cases/${caseId}/content`,
      isCompleted: stage.key === "stage5_channels",
      isActive: stage.key === "stage5_channels" && pathname.startsWith(`/cases/${caseId}/content`),
      isLocked: isTerminated,
    },
  ];

  return (
    <nav className="case-stepper" aria-label="商品全生命周期五阶流水线">
      <div className="case-stepper-track">
        {steps.map((step, idx) => {
          const content = (
            <div className="case-step-content">
              <span className="case-step-indicator">
                {step.isCompleted ? (
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <span className="case-step-num">{step.number}</span>
                )}
              </span>
              <div className="case-step-text">
                <strong className="case-step-title">{step.name}</strong>
                <small className="case-step-sub">{step.subText}</small>
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
                <div className="case-step-link disabled" title="需先完成前置阶段">
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

        {/* 独立决策战报出口 */}
        <div className="case-step-report-entry">
          <Link
            href={`/cases/${caseId}/report`}
            className={`case-report-btn ${pathname.startsWith(`/cases/${caseId}/report`) ? "active" : ""}`}
            title="查看或打印立项决策评审战报 (A4 PDF)"
          >
            <span>🖨️ 决策战报</span>
          </Link>
        </div>
      </div>
    </nav>
  );
}
