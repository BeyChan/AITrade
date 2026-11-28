// 保留兼容入口，视频资产写入统一复用内容仓储，避免出现两套模式校验逻辑。
export { createVideoAssetRecord } from "./repo/content";
