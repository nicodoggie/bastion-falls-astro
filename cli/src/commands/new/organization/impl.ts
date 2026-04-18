import type { LocalContext } from "@/context.js";
import renderTemplate, { type TemplateData } from "@/lib/template.js";
import type { NewCommandFlags } from "../commands.js";
import type { Organization } from "@bastion-falls/types";
import { getTargetPath } from "@/config.js";

interface NewOrganizationCommandFlags extends NewCommandFlags {
  type?: string;
  founded?: string;
  dissolved?: string;
  headquarters?: string;
  members?: string[];
}

interface OrganizationTemplate extends TemplateData {
  organization: Omit<Organization, "name">;
}

export default async function organization(
  this: LocalContext,
  flags: NewOrganizationCommandFlags,
  articleName: string
): Promise<void> {
  console.log("Creating organization", articleName);
  const {
    type,
    founded,
    dissolved,
    headquarters,
    members,
    tags,
    force = false,
  } = flags;

  const data: OrganizationTemplate = {
    title: articleName,
    organization: {
      type,
      founded,
      dissolved,
      headquarters,
      members: members?.map((name) => ({ name })),
    },
    tags: ["organizations", ...(tags ?? [])],
  };

  try {
    const targetDir = getTargetPath("organizations");
    await renderTemplate({
      name: articleName,
      template: "organization",
      targetDir,
      extension: "mdx",
      data,
      force,
    });
    console.log(`Created ${articleName} at ${targetDir}`);
  } catch (e) {
    console.log("Error creating organization", e);
    process.exit(1);
  }
}
