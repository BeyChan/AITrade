"use client";

import { useState } from "react";
import {
  supplier1688SearchUrl,
  supplierAlibabaSearchUrl,
  supplierGoogleSearchUrl,
  type SupplierLead,
} from "@/lib/supplier-discovery";

export function SupplierLeadQuickSearch({ leads }: { leads: SupplierLead[] }) {
  const [activeIndex, setActiveIndex] = useState(0);
  if (leads.length === 0) return null;

  const current = leads[activeIndex] ?? leads[0];

  return (
    <div className="ai-supplier-quick-search">
      <div className="ai-supplier-lead-tabs" role="tablist" aria-label="选择货源搜索词">
        {leads.map((lead, idx) => {
          const isActive = idx === activeIndex;
          return (
            <button
              key={`${lead.role}-${lead.query}`}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`ai-supplier-lead-tab${isActive ? " is-active" : ""}`}
              onClick={() => setActiveIndex(idx)}
            >
              {lead.query}
            </button>
          );
        })}
      </div>

      <div className="ai-supplier-lead">
        <div className="ai-supplier-lead-copy">
          <strong>{current.query}</strong>
        </div>
        <div className="ai-supplier-lead-links">
          <a href={supplier1688SearchUrl(current.query)} target="_blank" rel="noreferrer">打开 1688</a>
          <a href={supplierAlibabaSearchUrl(current.query)} target="_blank" rel="noreferrer">Alibaba</a>
          <a href={supplierGoogleSearchUrl(current.query)} target="_blank" rel="noreferrer">Google 查工厂</a>
        </div>
      </div>
    </div>
  );
}
