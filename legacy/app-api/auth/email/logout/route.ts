import {json} from '@/lib/server';
export async function POST(){return json({error:'メール認証は終了しました。運営IDとパスワードをご利用ください。'},410)}
