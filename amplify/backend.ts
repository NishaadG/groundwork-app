import { defineBackend } from "@aws-amplify/backend";

import { auth } from "./auth/resource";

const backend = defineBackend({ auth });

// Password policy and token lifetimes (silent refresh, remember me)
const { cfnUserPool, cfnUserPoolClient } = backend.auth.resources.cfnResources;
cfnUserPool.policies = {
  passwordPolicy: {
    minimumLength: 8,
    requireLowercase: false,
    requireUppercase: false,
    requireNumbers: false,
    requireSymbols: false,
    temporaryPasswordValidityDays: 7,
  },
};
cfnUserPoolClient.accessTokenValidity = 60;
cfnUserPoolClient.idTokenValidity = 60;
cfnUserPoolClient.refreshTokenValidity = 30;
cfnUserPoolClient.tokenValidityUnits = {
  accessToken: "minutes",
  idToken: "minutes",
  refreshToken: "days",
};
cfnUserPoolClient.preventUserExistenceErrors = "ENABLED";
