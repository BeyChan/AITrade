"use client";

export function PrintButton() {
  return (
    <button
      type="button"
      className="button primary"
      onClick={() => window.print()}
      style={{ fontSize: "12px", padding: "6px 14px", height: "34px", borderRadius: "8px" }}
    >
      🖨️ 打印 / 存为 PDF
    </button>
  );
}
