'use client';

import { useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetClose } from '@/components/ui/sheet';
import { ActionButton } from './action-button';

export function AppSheet({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  children: ReactNode;
}) {
  const returnTo = useRef<HTMLElement | null>(null);
  const content = useRef<HTMLDivElement | null>(null);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        ref={content}
        onEscapeKeyDown={(e) => e.preventDefault()}
        onKeyDownCapture={(e) => {
          // Only the modal containing focus handles Escape, including nested portals.
          const target = e.target instanceof Element ? e.target.closest('[role="dialog"], [role="alertdialog"]') : null;
          if (e.key === 'Escape' && target === content.current) {
            e.preventDefault();
            e.stopPropagation();
            onOpenChange(false);
          }
        }}
        side="bottom"
        className="app-sheet"
        showCloseButton={false}
        onOpenAutoFocus={() => {
          returnTo.current = document.activeElement as HTMLElement;
        }}
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          if (returnTo.current?.isConnected) {
            returnTo.current.focus();
          } else {
            const fallback = document.querySelector<HTMLElement>('main h1, main h2, h1, h2');
            if (fallback) {
              if (!fallback.hasAttribute('tabindex')) fallback.setAttribute('tabindex', '-1');
              fallback.focus();
            }
          }
        }}
      >
        <SheetHeader className="app-sheet-header">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <SheetClose asChild>
          <ActionButton tone="quiet" className="sheet-close" aria-label="閉じる">
            <X size={22} />
          </ActionButton>
        </SheetClose>
        <div className="app-sheet-body">{children}</div>
      </SheetContent>
    </Sheet>
  );
}
