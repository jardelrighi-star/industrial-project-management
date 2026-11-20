declare module "pako" {
  export function deflate(data: string, options: { to: "string" }): string;
  export function inflate(data: string, options: { to: "string" }): string;
}
