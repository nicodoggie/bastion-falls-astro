import Environment from "@rdfjs/environment";
import DataFactory from "@rdfjs/data-model/Factory.js";
import DatasetFactory from "@rdfjs/dataset/Factory.js";
import NamespaceFactory from "@rdfjs/namespace/Factory.js";
import TermMapFactory from "@rdfjs/term-map/Factory.js";
import ClownfaceFactory from "clownface/Factory.js";

/** RDF/JS environment compatible with `rdf-validate-shacl` defaults. */
export const rdfEnv = new Environment([
  DataFactory,
  DatasetFactory,
  NamespaceFactory,
  ClownfaceFactory,
  TermMapFactory,
]);
