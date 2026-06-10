declare module "@rdfjs/environment" {
  import type { DatasetCore } from "@rdfjs/types";

  export interface RdfEnvironment {
    dataset(): DatasetCore;
  }

  const Environment: new (factories: unknown[]) => RdfEnvironment;
  export default Environment;
}

declare module "@rdfjs/data-model/Factory.js" {
  const DataFactory: unknown;
  export default DataFactory;
}

declare module "@rdfjs/dataset/Factory.js" {
  const DatasetFactory: unknown;
  export default DatasetFactory;
}

declare module "@rdfjs/term-map/Factory.js" {
  const TermMapFactory: unknown;
  export default TermMapFactory;
}

declare module "clownface/Factory.js" {
  const ClownfaceFactory: unknown;
  export default ClownfaceFactory;
}

declare module "n3" {
  import type { Quad } from "@rdfjs/types";

  class Parser {
    constructor(options?: { format?: string });
    parse(content: string): Quad[];
  }

  const N3: {
    Parser: typeof Parser;
  };

  export { Parser };
  export default N3;
}
