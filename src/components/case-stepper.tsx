"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { deriveCaseStage, type CaseStageInput } from "@/lib/case-stage";

type CaseStepperProps = CaseStageInput & {
  reportId?: string | null;
  selectedSupplierName?: string | null;
  allowDemoBypass?: boolean;
};

export function CaseStepper(props: CaseStepperProps) {
  const pathname = usePathname();
  const stage = deriveCaseStage(props);
  const { caseId, selectedSupplierName, status, allowDemoBypass = false } = props;
  const isTerminated = status === "archived" || status === "rejected";
  const previewSuffix = allowDemoBypass && !stage.stepProgress.supplierAwarded ? "?preview=1" : "";

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
      href: `/cases/${caseId}/sourcing#supplier-award`,
      isCompleted: stage.stepProgress.supplierAwarded,
      isActive: pathname.startsWith(`/cases/${caseId}/sourcing`) && stage.stepProgress.supplierAwarded,
      isLocked: isTerminated,
    },
    {
      key: "stage4",
      number: "4",
      name: "文案与视觉",
      subText: stage.stepProgress.contentApproved
        ? "内容已终审"
        : previewSuffix
          ? "演示可跳过预览"
          : "五点 / 货架 / 生图",
      href: `/cases/${caseId}/content${previewSuffix}`,
      isCompleted: stage.stepProgress.contentApproved,
      isActive: pathname.startsWith(`/cases/${caseId}/content`),
      isLocked: isTerminated,
    },
    {
      key: "stage5",
      number: "5",
      name: "上架就绪",
      subText: stage.stepProgress.contentApproved
        ? "Flat File / ZIP 导出"
        : previewSuffix
          ? "演示可跳过预览"
          : "待完成文案与主图",
      href: `/cases/${caseId}/content${previewSuffix}#launch-ready`,
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
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <polyline points="6 9 6 2 18 2 18 9" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <rect x="6" y="14" width="12" height="8" />
            </svg>
            <span>决策战报</span>
          </Link>
        </div>
      </div>
    </nav>
  );
}
