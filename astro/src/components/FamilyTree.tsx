import PanZoomViewer from "./PanZoomViewer";

interface Props {
  src: string;
  width: number;
  height: number;
  alt: string;
}

export default function FamilyTree(props: Props) {
  return <PanZoomViewer {...props} inlineHeight="300px" />;
}
