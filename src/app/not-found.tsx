import Link from "next/link";

export default function NotFound() {
  return (
    <div className="page page-narrow">
      <div className="empty-state">
        <h1>页面不存在</h1>
        <p>这个商品项目可能已被删除，或者链接不正确。</p>
        <Link href="/" className="button primary">返回 AI 选品</Link>
      </div>
    </div>
  );
}
