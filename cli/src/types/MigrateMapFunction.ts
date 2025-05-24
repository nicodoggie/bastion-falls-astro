import type { BaseFrontmatter } from "@bastion-falls/types/BaseFrontmatter";

export type MigrateMapOutput<Key extends string, T> = BaseFrontmatter & {
  [key in Key]: T;
};

export type MigrateMapFunction<Key extends string, InputType extends BaseFrontmatter, OutputType> = (
  input: InputType
) => Promise<MigrateMapOutput<Key, OutputType>>;
