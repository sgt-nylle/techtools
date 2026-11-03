export interface CertAnalysisPayload {
  formatType: 'CERTIFICATE' | 'CSR' | 'PUBLIC_KEY';
  certRole?: 'ROOT_CA' | 'INTERMEDIATE_CA' | 'LEAF_END_ENTITY';
  subject: string;
  issuer?: string;
  serialNumber?: string;
  fingerprint256?: string;
  validFrom?: string;
  validTo?: string;
  validity?: {
    daysRemaining: number;
    isExpired: boolean;
    isNotYetValid: boolean;
    status: 'ACTIVE' | 'EXPIRED' | 'NOT_YET_VALID';
  };
  publicKey: {
    type?: string;
    algorithm?: string;
    details?: {
      modulusLength?: number;
      publicExponent?: number;
      namedCurve?: string;
    } | string | null;
  };
  sans?: string[];
  extendedKeyUsage?: string[];
  keyUsage?: string[];
  isCa?: boolean;
  isSelfSigned?: boolean;
  trust?: {
    trusted: boolean;
    status: string;
    details: string;
  };
  chainAvailable?: boolean;
  chainCount?: number;
  fullChainPem?: string;
  rawPem: string;
  opensslText?: string;
  durationMs: number;
}
