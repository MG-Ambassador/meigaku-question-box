'use client';
import { useRef } from 'react';
import { AlertDialog, AlertDialogContent, AlertDialogTitle, AlertDialogDescription, AlertDialogCancel, AlertDialogAction } from '@/components/ui/alert-dialog';
import { ActionButton } from './action-button';
export function ConfirmDialog({ open, onOpenChange, title, description, action, onConfirm }: {
  open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; action: string; onConfirm: () => void;
}) {
  const returnTo = useRef<HTMLElement | null>(null);
  return <AlertDialog open={open} onOpenChange={onOpenChange}><AlertDialogContent className="confirm-dialog"
    onOpenAutoFocus={() => { returnTo.current = document.activeElement as HTMLElement; }}
    onCloseAutoFocus={(e) => { e.preventDefault(); returnTo.current?.isConnected && returnTo.current.focus(); }}>
    <AlertDialogTitle>{title}</AlertDialogTitle><AlertDialogDescription>{description}</AlertDialogDescription>
    <div className="button-row"><AlertDialogCancel asChild><ActionButton tone="secondary">戻る</ActionButton></AlertDialogCancel>
      <AlertDialogAction asChild><ActionButton onClick={onConfirm}>{action}</ActionButton></AlertDialogAction></div>
  </AlertDialogContent></AlertDialog>;
}
