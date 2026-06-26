declare module "@rdfjs/namespace/Factory.js" {
  import type { NamespaceBuilder } from "@rdfjs/namespace";

  interface NamespaceFactory {
    namespace<TermNames extends string = string>(
      baseIRI: string,
    ): NamespaceBuilder<TermNames>;
  }

  interface NamespaceFactoryCtor {
    new (): NamespaceFactory;
    exports: ["namespace"];
  }

  const namespaceFactory: NamespaceFactoryCtor;

  export default namespaceFactory;
}
