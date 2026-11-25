import React, { Suspense, lazy } from 'react';

// Code-split: the Mail TLS Tester only loads when MOD-09 is opened.
const MailTlsTool = lazy(() => import('./MailTlsTool'));

export const MailTlsToolLazy: React.FC = () => (
  <Suspense
    fallback={
      <div className="loading-radar clean-box">
        <span className="radar-spinner">◎</span> WARMING UP SMTP TLS PROBE...
      </div>
    }
  >
    <MailTlsTool />
  </Suspense>
);

export default MailTlsToolLazy;
