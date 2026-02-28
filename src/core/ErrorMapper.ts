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
