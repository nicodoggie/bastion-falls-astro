import PanZoom, { Element } from "@sasza/react-panzoom";
import type { GetImageResult } from "astro";

interface Props {
  asset: GetImageResult;
  alt: string;
}

export default function FamilyTree(props: Props) {
  const { asset, alt } = props;
  const {width, height} = asset.options;

  return (
    <div style={{height: "300px"}}>
      <div style={{ width: "100%", height: "100%" }}>
        <PanZoom
          width={width}
          height={height}
          disabledMove={false}
        >
          <Element id="tree">
            <img src={asset.src} alt={alt} className="svg-image" />
          </Element>
        </PanZoom>
      </div>
      </div>
    );
    
}