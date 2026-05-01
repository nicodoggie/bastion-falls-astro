import PanZoomViewer from './PanZoomViewer';

interface Props {
  src: string;
  width: number;
  height: number;
  alt: string;
  inlineHeight?: string;
}

export default function MapViewer(props: Props) {
  return <PanZoomViewer {...props} />;
}
