import { TransformWrapper, TransformComponent } from "react-zoom-pan-pinch";

interface PanZoomWrapperProps {
  imageSrc: string;
  alt: string;
}

export default function PanZoomWrapper({ imageSrc, alt }: PanZoomWrapperProps) {
  return (
    <TransformWrapper
      initialScale={1}
      minScale={1}
      maxScale={10}
      centerOnInit={true}
      wheel={{ step: 0.1 }}
      doubleClick={{ disabled: true }}
      panning={{ disabled: false, velocityDisabled: true }}
      limitToBounds={true}
      centerZoomedOut={true}
      onPanningStop={() => {}}
      onZoomStop={() => {}}
    >
      <TransformComponent wrapperClass="panzoom-container" contentClass="panzoom-content">
        <img src={imageSrc} alt={alt} className="svg-image" />
      </TransformComponent>
    </TransformWrapper>
  );
} 