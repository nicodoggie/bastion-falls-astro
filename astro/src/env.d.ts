/// <reference types="astro/client" />
/// <reference path="../../node_modules/starlight-auto-sidebar/virtual.d.ts" />

declare module "@bastion-falls/lexicon-components/*.astro" {
  const Component: AstroComponent;
  export default Component;
}

declare module "@/components/*.astro" {
  const Component: AstroComponent;
  export default Component;
}
