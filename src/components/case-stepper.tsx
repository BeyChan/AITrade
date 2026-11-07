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
      name: "竞品初筛",
      subText: reportId ? "已关联研报" : "案卷立项",
      href: reportId ? `/competitors?id=${encodeURIComponent(reportId)}` : `/cases/${caseId}`,
      isCompleted: true, // 既已进入案卷，初筛必已通过
      isActive: false,
      isLocked: false,
    },
    {
      key: "stage2",
      number: "2",
      name: "寻源询价",
      subText: stage.stepProgress.sourcingQuotes ? `已有 ${(props.quoteCount ?? 0)} 份报价` : "待录入报价",
      href: `/cases/${caseId}/sourcing`,
      isCompleted: stage.stepProgress.sourcingQuotes,
      isActive: pathname.startsWith(`/cases/${caseId}/sourcing`) && !stage.stepProgress.supplierAwarded,
      isLocked: isTerminated,
    },
    {
      key: "stage3",
      number: "3",
      name: "财务核准",
      subText: stage.stepProgress.supplierAwarded
        ? (selectedSupplierName ? `已定标: ${selectedSupplierName}` : "已核准定标")
        : "待对比定标",
      href: `/cases/${caseId}/sourcing`,
      isCompleted: stage.stepProgress.supplierAwarded,
      isActive: pathname === `/cases/${caseId}` || (pathname.startsWith(`/cases/${caseId}/sourcing`) && stage.key === "stage3_financial"),
      isLocked: !stage.stepProgress.sourcingQuotes && status !== "review_pending",
    },
    {
      key: "stage4",
      number: "4",
      name: "内容打磨",
      subText: stage.stepProgress.contentApproved ? "内容终审通过" : stage.stepProgress.supplierAwarded ? "制作与预检中" : "需先定标",
      href: `/cases/${caseId}/content`,
      isCompleted: stage.stepProgress.contentApproved,
      isActive: pathname.startsWith(`/cases/${caseId}/content`),
      isLocked: !stage.stepProgress.supplierAwarded,
    },
    {
      key: "stage5",
      number: "5",
      name: "渠道就绪",
      subText: stage.stepProgress.contentApproved ? "Flat File 导出" : "待内容终审",
      href: `/cases/${caseId}/channels`,
      isCompleted: stage.stepProgress.channelReady,
      isActive: pathname.startsWith(`/cases/${caseId}/channels`),
      isLocked: !stage.stepProgress.contentApproved,
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
