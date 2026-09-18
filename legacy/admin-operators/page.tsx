import {admin} from '@/lib/server';
import Operators from './operators';
export const dynamic='force-dynamic';
export default async function Page(){const u=await admin();if(u?.role!=='owner')return <main className="operator-entry"><h1>運営責任者専用です</h1><a href="/admin">運営用ログインへ</a></main>;return <Operators/>}
