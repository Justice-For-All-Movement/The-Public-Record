import {describe,expect,it} from "vitest";
import {loadConfig,validSessionSecret} from "../lib/server/config";

const secret=Buffer.alloc(32,7).toString("base64url");
const oidc={AUTH_PROVIDER:"oidc",SESSION_SECRET:secret,OIDC_ISSUER:"https://id.example.org",
  OIDC_CLIENT_ID:"public-record",OIDC_REDIRECT_URI:"https://records.example.org/api/auth/callback",
  OIDC_AUTHORIZATION_ENDPOINT:"https://id.example.org/authorize",OIDC_TOKEN_ENDPOINT:"https://id.example.org/token",
  OIDC_JWKS_URI:"https://id.example.org/jwks"};

describe("runtime configuration",()=>{
  it("boots with no credentials at all",()=>{
    const c=loadConfig({NODE_ENV:"production"});
    expect(c).toMatchObject({stage:"production",databaseUrl:null,authMode:"disabled",authProblem:null,
      sessionSecret:null,aggregatorUrl:null,aggregatorFixtures:false});
  });
  it("never enables synthetic identities in production",()=>{
    const c=loadConfig({NODE_ENV:"production",AUTH_PROVIDER:"fake",SESSION_SECRET:secret});
    expect(c.authMode).toBe("disabled");
    expect(c.authProblem).toMatch(/never enabled in production/);
    // An unrecognised stage on a production build is production.
    expect(loadConfig({NODE_ENV:"production",TPR_ENVIRONMENT:"prod",AUTH_PROVIDER:"fake"}).authMode).toBe("disabled");
  });
  it("allows the fake provider in preview only with a real session secret",()=>{
    expect(loadConfig({NODE_ENV:"production",TPR_ENVIRONMENT:"preview",AUTH_PROVIDER:"fake"}).authMode).toBe("disabled");
    expect(loadConfig({NODE_ENV:"production",TPR_ENVIRONMENT:"preview",AUTH_PROVIDER:"fake",SESSION_SECRET:secret}).authMode).toBe("fake");
    const local=loadConfig({NODE_ENV:"development",AUTH_PROVIDER:"fake"});
    expect(local.authMode).toBe("fake");
    expect(validSessionSecret(local.sessionSecret)).toBe(true);
  });
  it("requires complete same-origin HTTPS OIDC configuration",()=>{
    expect(loadConfig(oidc)).toMatchObject({authMode:"oidc",authProblem:null});
    expect(loadConfig({...oidc,OIDC_JWKS_URI:"https://keys.attacker.example/jwks"}).authMode).toBe("disabled");
    expect(loadConfig({...oidc,OIDC_TOKEN_ENDPOINT:"http://id.example.org/token"}).authMode).toBe("disabled");
    expect(loadConfig({...oidc,SESSION_SECRET:"short"}).authProblem).toMatch(/SESSION_SECRET/);
  });
  it("validates role names and restricts unsafe overrides to local stages",()=>{
    expect(loadConfig({DATABASE_RUNTIME_ROLE:"tpr_app_runtime"}).databaseRuntimeRole).toBe("tpr_app_runtime");
    expect(loadConfig({DATABASE_RUNTIME_ROLE:"x; DROP TABLE y"}).databaseRuntimeRole).toBeNull();
    expect(loadConfig({NODE_ENV:"production",TPR_ALLOW_PRIVILEGED_DB_ROLE:"true"}).allowPrivilegedDbRole).toBe(false);
    expect(loadConfig({NODE_ENV:"production",FOIA_AGGREGATOR_FIXTURES:"true"}).aggregatorFixtures).toBe(false);
    expect(loadConfig({FOIA_AGGREGATOR_PUBLIC_URL:"http://insecure.example"}).aggregatorUrl).toBeNull();
  });
});
