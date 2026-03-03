/**
 * 错误映射器
 *
 * 用于包装主循环，捕获并打印错误堆栈。
 * (注：Screeps 原生支持 source map，这里主要是为了防止未捕获异常中断循环)
 */
export class ErrorMapper {
  public static wrapLoop(loop: () => void): () => void {
    return () => {
      try {
        loop();
      } catch (e) {
        const error = e as Error;
        console.log(error?.stack ?? String(e));
      }
    };
  }
}
