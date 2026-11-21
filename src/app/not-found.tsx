import Link from "next/link";
import { EmptyState } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="page page-narrow">
      <EmptyState
        headingLevel="h1"
        title="页面不存在"
        description="这个商品项目可能已被删除，或者链接不正确。"
        actions={<Link href="/" className="button primary">返回工作台</Link>}
      />
    </div>
  );
}
