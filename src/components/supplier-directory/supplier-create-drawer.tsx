"use client";

type Props = {
  createAction: (formData: FormData) => void;
  onClose: () => void;
};

export function SupplierCreateDrawer({ createAction, onClose }: Props) {
  return (
        <section
          className="section"
          style={{
            border: "1.5px dashed var(--green)",
            background: "rgba(31, 122, 85, 0.02)",
            borderRadius: "12px",
            padding: "20px",
          }}
        >
          <div className="section-header" style={{ marginBottom: "16px" }}>
            <div>
              <h3 style={{ margin: 0, fontSize: "16px", color: "var(--ink)", fontWeight: 700 }}>
                录入 1688 / 线下源头工厂档案
              </h3>
              <p style={{ margin: "4px 0 0 0", fontSize: "12px", color: "var(--muted)" }}>
                录入后将永久保存在企业供应链资产库中，后续在任何商品立项时均可直接调取。
              </p>
            </div>
          </div>

          <form action={createAction} className="stack">
            <div className="form-grid">
              <div className="field">
                <label htmlFor="name">工厂名称 *</label>
                <input id="name" name="name" required placeholder="如：宁波市倍洁日用品制造有限公司" />
              </div>
              <div className="field">
                <label htmlFor="platform">供应商平台 / 来源</label>
                <input id="platform" name="platform" defaultValue="1688" placeholder="1688 / 阿里国际站 / 广交会" />
              </div>
              <div className="field">
                <label htmlFor="contact">联系人及电话/微信 *</label>
                <input id="contact" name="contact" required placeholder="如：陈经理 · 138-xxxx-xxxx" />
              </div>
              <div className="field">
                <label htmlFor="country">生产地 / 国家</label>
                <input id="country" name="country" defaultValue="CN" placeholder="CN" />
              </div>
              <div className="field full">
                <label htmlFor="url">1688 店铺 / 工厂主页链接</label>
                <input id="url" name="url" type="url" placeholder="https://detail.1688.com/offer/..." />
              </div>
              <div className="field full">
                <label htmlFor="notes">主营类目、验厂资质与配合优势</label>
                <textarea
                  id="notes"
                  name="notes"
                  rows={2}
                  placeholder="如：1688 实力商家，主营免手洗拖把与宠物注塑件，支持定制包装贴标，通过 BSCI 验厂。"
                />
              </div>
            </div>

            <div style={{ display: "flex", gap: "10px", marginTop: "8px" }}>
              <button type="submit" className="button primary">
                保存入库
              </button>
              <button type="button" className="button ghost" onClick={() => onClose()}>
                取消
              </button>
            </div>
          </form>
        </section>
  );
}
