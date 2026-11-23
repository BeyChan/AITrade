"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { deriveCaseWorkflowSnapshot, type CaseStageInput } from "@/lib/case-stage";

type CaseStepperProps = CaseStageInput & {
  reportId?: string | null;
  selectedSupplierName?: string | null;
  allowDemoBypass?: boolean;
};

export function CaseStepper(props: CaseStepperProps) {
  const pathname = usePathname();
  const stage = deriveCaseWorkflowSnapshot(props);
  const { caseId, selectedSupplierName, allowDemoBypass = false } = props;
  const isTerminated = stage.caseLifecycle === "archived";
  const isNoGoBlocked = stage.tradeGate === "NO-GO";
  const lockDownstream = isTerminated || isNoGoBlocked;
  const previewSuffix = allowDemoBypass && !stage.stepProgress.supplierAwarded && !lockDownstream ? "?preview=1" : "";

  const steps = [
    {
      key: "stage1",
      number: "1",
      name: "选品与利润",
      subText: isNoGoBlocked
        ? "NO-GO 已拦截"
        : stage.stepProgress.financialReview
          ? (stage.tradeGate === "NO-GO_EXCEPTION" ? "例外通过 · 模型已建" : "成本模型已建")
          : "待测算利润",
      href: `/cases/${caseId}?tab=overview`,
      isCompleted: stage.stepProgress.financialReview,
      isActive: pathname === `/cases/${caseId}`,
      isLocked: false,
    },
    {
      key: "stage2",
      number: "2",
      name: "供应商报价与打样",
      subText: stage.stepProgress.sourcingQuotes
        ? `已有 ${stage.facts.quoteCount} 份报价`
        : "待录入报价",
      href: `/cases/${caseId}/sourcing`,
      isCompleted: stage.stepProgress.sourcingQuotes,
      isActive: pathname.startsWith(`/cases/${caseId}/sourcing`) && !stage.stepProgress.supplierAwarded,
      isLocked: lockDownstream,
    },
    {
      key: "stage3",
      number: "3",
      name: "人工定标",
      subText: stage.stepProgress.supplierAwarded
        ? (selectedSupplierName ? `已定标: ${selectedSupplierName}` : "已人工定标")
        : stage.stepProgress.sourcingQuotes
          ? "对比并定标"
          : "待录入报价",
      href: `/cases/${caseId}/sourcing#supplier-award`,
      isCompleted: stage.stepProgress.supplierAwarded,
      isActive: pathname.startsWith(`/cases/${caseId}/sourcing`) && stage.stepProgress.supplierAwarded,
      isLocked: lockDownstream,
    },
    {
      key: "stage4",
      number: "4",
      name: "文案与视觉",
      subText: stage.stepProgress.contentApproved
        ? "内容已终审"
        : previewSuffix
          ? "演示可跳过预览"
          : stage.stepProgress.supplierAwarded
            ? (stage.facts.approvedMainImageCount === 0 ? "缺主图 · 去视觉工坊" : "待人工终审")
            : "定标后解锁",
      href: `/cases/${caseId}/content${previewSuffix}`,
      isCompleted: stage.stepProgress.contentApproved,
      isActive: pathname.startsWith(`/cases/${caseId}/content`) && !stage.stepProgress.contentApproved,
      isLocked: lockDownstream,
    },
    {
      key: "stage5",
      number: "5",
      name: "上架交付",
      subText: stage.deliveryLabel,
      href: `/cases/${caseId}/content${previewSuffix}#launch-ready`,
      isCompleted: stage.deliveryState === "complete",
      isActive: stage.key === "stage5_channels" && pathname.startsWith(`/cases/${caseId}/content`),
      isLocked: lockDownstream || (!stage.stepProgress.contentApproved && !previewSuffix),
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
                <div
                  className="case-step-link disabled"
                  title={isNoGoBlocked ? "NO-GO 门禁已拦截，请先申请例外审批" : "需先完成前置阶段"}
                >
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
