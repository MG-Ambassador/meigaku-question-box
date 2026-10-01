'use client';

import { useRef } from 'react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { ActionButton } from './action-button';

export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  action,
  actionTone = 'primary',
  onConfirm,
  secondaryAction,
  onSecondaryAction,
  cancelText = '戻る',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  action: string;
  actionTone?: 'primary' | 'secondary' | 'danger';
  onConfirm: () => void;
  secondaryAction?: string;
  onSecondaryAction?: () => void;
  cancelText?: string;
}) {
  const returnTo = useRef<HTMLElement | null>(null);
  const content = useRef<HTMLDivElement | null>(null);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent
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
        className="confirm-dialog"
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
        <AlertDialogTitle>{title}</AlertDialogTitle>
        <AlertDialogDescription>{description}</AlertDialogDescription>
        <div className="button-row" style={{ flexWrap: 'wrap', gap: '8px' }}>
          <AlertDialogCancel asChild>
            <ActionButton tone="secondary">{cancelText}</ActionButton>
          </AlertDialogCancel>
          {secondaryAction && onSecondaryAction && (
            <AlertDialogAction asChild>
              <ActionButton tone="danger" onClick={onSecondaryAction}>
                {secondaryAction}
              </ActionButton>
            </AlertDialogAction>
          )}
          <AlertDialogAction asChild>
            <ActionButton tone={actionTone} onClick={onConfirm}>
              {action}
            </ActionButton>
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
}
