import {operator} from '@/lib/password-auth';
import PasswordLogin from '../password-login';
export const dynamic='force-dynamic';
export default async function Page(){const u=await operator();return <PasswordLogin change={!!u} required={!!u?.mustChange}/>}
