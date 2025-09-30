import PanZoom from '@sasza/react-panzoom';

interface Props {
  src: string;
  width: number;
  height: number;
  alt: string;
}

export default function FamilyTree(props: Props) {
  const { src, width, height, alt } = props;
  const dialogId = `familytree-dialog`;
  const fullscreenTargetId = `familytree-dialog-target`;
  const inlineTargetId = `familytree-inline-${Math.random().toString(36).slice(2)}`;
  const inlineModalBtnId = `familytree-inline-modal-btn-${Math.random()
    .toString(36)
    .slice(2)}`;

  if (
    typeof window !== 'undefined' &&
    !(window as any).__bfFamilyTreeFSListener
  ) {
    (window as any).__bfFamilyTreeFSListener = true;
    document.addEventListener('fullscreenchange', () => {
      const btn = document.getElementById(
        inlineModalBtnId,
      ) as HTMLButtonElement | null;
      const inlineEl = document.getElementById(inlineTargetId);
      if (!btn || !inlineEl) return;
      if (document.fullscreenElement === inlineEl) {
        btn.style.display = 'none';
      } else {
        btn.style.display = 'grid';
      }
    });
  }

  const setDialogSize = (dlg: HTMLDialogElement) => {
    dlg.style.width = '90vw';
    dlg.style.height = '80vh';
    dlg.style.maxWidth = '1200px';
    dlg.style.maxHeight = '90vh';
  };

  const enterFullscreen = async (el: Element) => {
    try {
      if (!document.fullscreenElement) {
        // @ts-ignore - different vendor prefixes are handled by browsers
        await (el as any).requestFullscreen?.();
      }
    } catch {}
  };

  const exitFullscreen = async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
    } catch {}
  };

  const openDialog = (fullscreen = false) => {
    const dlg = document.getElementById(dialogId) as HTMLDialogElement | null;
    if (dlg && typeof dlg.showModal === 'function') {
      setDialogSize(dlg);
      dlg.showModal();
      try {
        dlg.focus();
      } catch {}
      if (fullscreen) {
        // Request fullscreen on the content container for better support
        queueMicrotask(() => {
          const target = document.getElementById(fullscreenTargetId) || dlg;
          if (target) void enterFullscreen(target);
        });
      }
    }
  };

  const closeDialog = () => {
    const dlg = document.getElementById(dialogId) as HTMLDialogElement | null;
    if (dlg && dlg.open) {
      // Ensure we exit fullscreen first, if active
      if (document.fullscreenElement) {
        void exitFullscreen();
      }
      dlg.close();
    }
  };

  return (
    <div style={{ height: '300px' }}>
      <div
        style={{
          width: '100%',
          height: '100%',
          cursor: 'grab',
          userSelect: 'none',
          position: 'relative',
        }}
        id={inlineTargetId}
        onPointerDown={(e) => {
          (e.currentTarget as HTMLDivElement).style.cursor = 'grabbing';
        }}
        onPointerUp={(e) => {
          (e.currentTarget as HTMLDivElement).style.cursor = 'grab';
        }}
        onPointerLeave={(e) => {
          (e.currentTarget as HTMLDivElement).style.cursor = 'grab';
        }}
        onDoubleClick={(e) => {
          const inlineEl = document.getElementById(inlineTargetId);
          if (inlineEl && document.fullscreenElement === inlineEl) return;
          openDialog(e.shiftKey);
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: '8px',
            right: '8px',
            display: 'flex',
            gap: '8px',
            alignItems: 'center',
            zIndex: 2,
          }}
        >
          <button
            type="button"
            aria-label="Open modal"
            title="Open modal"
            onClick={() => openDialog(false)}
            style={{
              background: 'rgba(255,255,255,0.12)',
              color: '#fff',
              border: 'none',
              padding: 0,
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'grid',
              placeItems: 'center',
              width: '32px',
              height: '32px',
              lineHeight: 0,
            }}
            id={inlineModalBtnId}
          >
            <svg
              style={{ display: 'block' }}
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M4 4h16v16H4z" />
              <path d="M8 8h8v8H8z" />
            </svg>
          </button>
          <button
            type="button"
            aria-label="Fullscreen"
            title="Fullscreen"
            onClick={() => {
              const target = document.getElementById(inlineTargetId);
              if (!target) return;
              if (document.fullscreenElement) {
                void exitFullscreen();
                const btn = document.getElementById(
                  inlineModalBtnId,
                ) as HTMLButtonElement | null;
                if (btn) btn.style.display = 'grid';
              } else {
                void enterFullscreen(target);
                const btn = document.getElementById(
                  inlineModalBtnId,
                ) as HTMLButtonElement | null;
                if (btn) btn.style.display = 'none';
              }
            }}
            style={{
              background: 'rgba(255,255,255,0.12)',
              color: '#fff',
              border: 'none',
              padding: 0,
              margin: 0,
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'grid',
              placeItems: 'center',
              width: '32px',
              height: '32px',
              lineHeight: 0,
            }}
          >
            <svg
              style={{ display: 'block' }}
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M15 3h6v6" />
              <path d="M21 3l-7 7" />
              <path d="M9 21H3v-6" />
              <path d="M3 21l7-7" />
            </svg>
          </button>
        </div>
        <PanZoom
          width={width}
          height={height}
          disabledMove={false}
          disabledUserSelect
        >
          <img
            src={src}
            alt={alt}
            className="svg-image"
            draggable={false}
            style={{
              userSelect: 'none',
              cursor: 'grab',
            }}
            onMouseDown={(e) => {
              (e.currentTarget as HTMLImageElement).style.cursor = 'grabbing';
            }}
            onMouseUp={(e) => {
              (e.currentTarget as HTMLImageElement).style.cursor = 'grab';
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLImageElement).style.cursor = 'grab';
            }}
            onDragStart={(e) => e.preventDefault()}
          />
        </PanZoom>
      </div>
      <dialog
        id={dialogId}
        style={{
          padding: 0,
          border: 'none',
          position: 'fixed',
          inset: 0,
          margin: 'auto',
          width: '90vw',
          maxWidth: '1200px',
          height: '80vh',
          maxHeight: '90vh',
          background: 'transparent',
          overflow: 'hidden',
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget) closeDialog();
        }}
        // No Esc-to-close; click backdrop or press Close
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            background: 'rgba(0,0,0,0.85)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: '12px',
              right: '12px',
              display: 'flex',
              gap: '10px',
              alignItems: 'center',
              zIndex: 2,
            }}
          >
            <button
              type="button"
              onClick={() => {
                const target =
                  (document.getElementById(
                    fullscreenTargetId,
                  ) as HTMLElement | null) ||
                  (document.getElementById(
                    dialogId,
                  ) as HTMLDialogElement | null);
                if (!target) return;
                if (document.fullscreenElement) {
                  void exitFullscreen();
                } else {
                  void enterFullscreen(target);
                }
              }}
              aria-label="Toggle fullscreen"
              title="Toggle fullscreen"
              style={{
                background: 'rgba(255,255,255,0.12)',
                color: '#fff',
                border: 'none',
                padding: 0,
                borderRadius: '8px',
                cursor: 'pointer',
                display: 'grid',
                placeItems: 'center',
                width: '40px',
                height: '40px',
                lineHeight: 0,
              }}
            >
              <svg
                style={{ display: 'block' }}
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M15 3h6v6" />
                <path d="M21 3l-7 7" />
                <path d="M9 21H3v-6" />
                <path d="M3 21l7-7" />
              </svg>
            </button>
            <button
              type="button"
              onClick={closeDialog}
              aria-label="Close"
              title="Close"
              style={{
                background: 'rgba(255,255,255,0.12)',
                color: '#fff',
                border: 'none',
                padding: 0,
                borderRadius: '8px',
                cursor: 'pointer',
                display: 'grid',
                placeItems: 'center',
                margin: 0,
                width: '40px',
                height: '40px',
                lineHeight: 0,
              }}
            >
              <svg
                style={{ display: 'block' }}
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
              >
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div
            id={fullscreenTargetId}
            style={{ width: '100%', height: '100%', zIndex: 1 }}
          >
            <PanZoom
              width={width}
              height={height}
              disabledMove={false}
              disabledUserSelect
            >
              <img
                src={src}
                alt={alt}
                draggable={false}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  userSelect: 'none',
                  cursor: 'grab',
                }}
                onMouseDown={(e) => {
                  (e.currentTarget as HTMLImageElement).style.cursor =
                    'grabbing';
                }}
                onMouseUp={(e) => {
                  (e.currentTarget as HTMLImageElement).style.cursor = 'grab';
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLImageElement).style.cursor = 'grab';
                }}
                onDragStart={(e) => e.preventDefault()}
              />
            </PanZoom>
          </div>
        </div>
      </dialog>
    </div>
  );
}
