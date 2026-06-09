import type { CharacterSexOrgan } from "@bastion-falls/types/Character";

export interface CharacterSexOrganRow {
  label: string;
  value: string;
}

export interface CharacterSexOrganSection {
  rows: CharacterSexOrganRow[];
  title: string;
}

function addRow(
  rows: CharacterSexOrganRow[],
  label: string,
  value: string | number | undefined,
): void {
  if (value == null) return;
  rows.push({ label, value: `${value}` });
}

export function getCharacterSexOrganSections(
  sexOrgans: CharacterSexOrgan[],
): CharacterSexOrganSection[] {
  const sections: CharacterSexOrganSection[] = [];

  for (const organ of sexOrgans) {
    const rows: CharacterSexOrganRow[] = [];

    switch (organ.type) {
      case "penis":
        addRow(rows, "Length", organ.length);
        addRow(rows, "Girth", organ.girth);
        addRow(rows, "Pubic hair length", organ.pubicHair?.length);
        addRow(rows, "Pubic hair style", organ.pubicHair?.style);
        addRow(rows, "Pubic hair color", organ.pubicHair?.color);
        sections.push({ title: "Penis", rows });
        break;

      case "vagina":
        addRow(rows, "Profile", organ.profile?.join(", "));
        addRow(rows, "Depth", organ.depth);
        addRow(rows, "Elasticity", organ.elasticity);
        addRow(rows, "Pubic hair length", organ.pubicHair?.length);
        addRow(rows, "Pubic hair style", organ.pubicHair?.style);
        addRow(rows, "Pubic hair color", organ.pubicHair?.color);
        sections.push({ title: "Vagina", rows });
        break;

      case "breasts":
        addRow(rows, "Size", organ.size);
        addRow(rows, "Nipples", organ.nipples);
        sections.push({ title: "Breasts", rows });
        break;
    }
  }

  return sections;
}
