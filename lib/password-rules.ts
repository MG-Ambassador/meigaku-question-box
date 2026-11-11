/** 運営パスワードの規則（サーバーの server/src/password.ts と同じ値） */
export const PASSWORD_MIN_LENGTH = 15;
export const PASSWORD_MAX_LENGTH = 128;

/** 文字数はコードポイント単位で数える。問題がなければ空文字を返す */
export function validateNewPassword(current: string, next: string, confirm: string): string {
  const length = [...next].length;
  if (!current) return '現在のパスワードを入力してください。';
  if (length < PASSWORD_MIN_LENGTH || next.length > PASSWORD_MAX_LENGTH) {
    return `新しいパスワードは${PASSWORD_MIN_LENGTH}〜${PASSWORD_MAX_LENGTH}文字で入力してください。`;
  }
  if (next === current) return '新しいパスワードは現在のパスワードと異なるものにしてください。';
  if (next !== confirm) return '確認用のパスワードが一致しません。';
  return '';
}
