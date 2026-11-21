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
      subText: props.hasCostModel ? "已建成本模型" : "待测算利润",
      href: `/cases/${caseId}`,
      isCompleted: props.hasCostModel,
      isActive: pathname === `/cases/${caseId}`,
      isLocked: false,
    },
    {
      key: "stage2",
      number: "2",
      name: "1688 寻源与打样",
      subText: stage.stepProgress.supplierAwarded
        ? (selectedSupplierName ? `已定标: ${selectedSupplierName}` : "已定标")
        : stage.stepProgress.sourcingQuotes
          ? `已有 ${props.quoteCount ?? 0} 份报价`
          : "比价与打样",
      href: `/cases/${caseId}/sourcing`,
      isCompleted: stage.stepProgress.supplierAwarded,
      isActive: pathname.startsWith(`/cases/${caseId}/sourcing`),
      isLocked: isTerminated,
    },
    {
      key: "stage3",
      number: "3",
      name: "文案与合规雷达",
      subText: stage.stepProgress.contentApproved ? "文案已就绪" : "五点与货架测试",
      href: `/cases/${caseId}/content`,
      isCompleted: stage.stepProgress.contentApproved,
      isActive: pathname.startsWith(`/cases/${caseId}/content`),
      isLocked: isTerminated,
    },
    {
      key: "stage4",
      number: "4",
      name: "视觉工坊",
      subText: "主图 / 视频生成",
      href: `/studio?tab=image&caseId=${encodeURIComponent(caseId)}`,
      isCompleted: false,
      isActive: pathname.startsWith("/studio"),
      isLocked: isTerminated,
    },
    {
      key: "stage5",
      number: "5",
      name: "立项战报",
      subText: "PDF / 素材打包",
      href: `/cases/${caseId}/report`,
      isCompleted: stage.stepProgress.contentApproved && stage.stepProgress.supplierAwarded,
      isActive: pathname.startsWith(`/cases/${caseId}/report`),
      isLocked: false,
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
