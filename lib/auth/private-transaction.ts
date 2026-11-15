import type {Pool,PoolClient} from "pg";
export interface ServerVerifiedSubject { readonly subject:string; readonly issuer:string; readonly expiresAt:number; }
export interface PrivateTransactionOptions {
  /**
   * NOLOGIN, NOBYPASSRLS role to assume for the transaction (SET LOCAL ROLE).
   * Lets a deployment whose login role is privileged still run private work
   * under row-level security. Must be a plain lower-case identifier.
   */
  runtimeRole?:string|null;
  /** Refuse the transaction if the effective role is superuser or BYPASSRLS. */
  requireRowSecurity?:boolean;
  /** Server-owned roles exposed to RLS policies as transaction-local `tpr.roles`. */
  roles?:readonly string[];
}
export class PrivilegedDatabaseRoleError extends Error {
  constructor(){super("Private data access refused: database role bypasses row-level security");this.name="PrivilegedDatabaseRoleError";}
}
const roleName=/^[a-z_][a-z0-9_]{0,62}$/;

/**
 * Every private SQL operation must run inside a transaction with a verified
 * application identity. The DB login role must NOT own data or BYPASSRLS.
 *
 * Identity must come from verifySession(), never a client-supplied subject.
 * This adds isolation; it does not replace policy checks in authorization.ts.
 */
export async function withPrivateSubject<T>(
  pool:Pick<Pool,"connect">,
  session:ServerVerifiedSubject,
  fn:(client:PoolClient)=>Promise<T>,
  options:PrivateTransactionOptions={}
):Promise<T>{
  if(!session || typeof session.subject!=="string" ||
     !session.subject.trim() || session.subject.length>255 ||
     !session.issuer?.startsWith("https://") || !Number.isSafeInteger(session.expiresAt) ||
     session.expiresAt<=Math.floor(Date.now()/1000))
    throw new Error("Authentication required");
  if(options.runtimeRole!=null && !roleName.test(options.runtimeRole))
    throw new Error("Invalid database runtime role");
  const client=await pool.connect();
  let started=false;
  try{
    await client.query("BEGIN");started=true;
    // Identifier validated above; SET ROLE cannot take a bind parameter.
    if(options.runtimeRole)await client.query(`SET LOCAL ROLE ${options.runtimeRole}`);
    if(options.requireRowSecurity){
      const r=await client.query<{rolsuper:boolean;rolbypassrls:boolean}>(
        "SELECT rolsuper,rolbypassrls FROM pg_roles WHERE rolname=current_user");
      const row=r.rows[0];
      if(!row || row.rolsuper!==false || row.rolbypassrls!==false)throw new PrivilegedDatabaseRoleError();
    }
    await client.query("SELECT set_config('tpr.subject',$1,true)",[session.subject]);
    if(options.roles?.length){
      if(options.roles.some(r=>!/^[a-z_]{3,32}$/.test(r)))throw new Error("Invalid role");
      await client.query("SELECT set_config('tpr.roles',$1,true)",[options.roles.join(",")]);
    }
    const result=await fn(client);
    await client.query("COMMIT");
    return result;
  }catch(error){
    if(started)await client.query("ROLLBACK");
    throw error;
  }finally{client.release();}
}
