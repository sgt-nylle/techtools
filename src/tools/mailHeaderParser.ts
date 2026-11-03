export interface MailHeaderHop {
  hop: number;
  from: string;
  by: string;
  protocol: string;
  forRecipient: string;
  id: string;
  tls: string;
  ip: string;
  dateString: string;
  timestamp: string;
  delaySeconds: number;
  raw: string;
}

export interface MailHeaderAnalysis {
  ok: boolean;
  summary: {
    subject: string;
    from: string;
    to: string;
    date: string;
    messageId: string;
    returnPath: string;
    deliveredTo: string;
    totalHops: number;
  };
  auth: {
    spf: {
      status: string;
      details: string;
    };
    dkim: {
      status: string;
      details: string;
      signatures: Array<{
        domain: string;
        selector: string;
        algorithm: string;
        raw: string;
      }>;
    };
    dmarc: {
      status: string;
      details: string;
    };
    arc: {
      status: string;
      details: string;
    };
  };
  hops: MailHeaderHop[];
  allHeaders: Array<{ name: string; value: string }>;
}

export function parseEmailMessageHeader(rawText: string): { data?: MailHeaderAnalysis; error?: string } {
  if (!rawText || !rawText.trim()) {
    return { error: 'Please paste raw email headers.' };
  }

  const lines = rawText.split(/\r?\n/);
  const headers: Array<{ name: string; value: string }> = [];
  let current: { name: string; value: string } | null = null;

  for (const line of lines) {
    if (/^[ \t]/.test(line)) {
      if (current) current.value += ' ' + line.trim();
    } else {
      const match = line.match(/^([A-Za-z0-9_-]+):(.*)$/);
      if (match) {
        current = { name: match[1], value: match[2].trim() };
        headers.push(current);
      }
    }
  }

  // Check email header format recognition
  const recognizedPattern = /^(received|delivered-to|from|to|subject|date|message-id|return-path|authentication-results|received-spf|dkim-signature|arc-[a-z0-9_-]+|content-type|mime-version|reply-to|cc|bcc|sender|x-[a-z0-9_-]+):/i;
  let recognizedCount = 0;
  for (const h of headers) {
    if (recognizedPattern.test(h.name + ':')) recognizedCount++;
  }

  if (recognizedCount < 2) {
    return { error: 'Navy Mail Header Format Not DETECTED!' };
  }

  const getHeader = (name: string): string[] => {
    return headers
      .filter((h) => h.name.toLowerCase() === name.toLowerCase())
      .map((h) => h.value);
  };

  const getFirstHeader = (name: string): string => getHeader(name)[0] || '';

  const subject = getFirstHeader('subject');
  const from = getFirstHeader('from');
  const to = getFirstHeader('to');
  const date = getFirstHeader('date');
  const messageId = getFirstHeader('message-id');
  const returnPath = getFirstHeader('return-path');
  const deliveredTo = getFirstHeader('delivered-to');

  // Authentication Audit
  const receivedSpf = getHeader('received-spf');
  const authResults = getHeader('authentication-results');
  const arcAuth = getHeader('arc-authentication-results');
  const dkimSignatures = getHeader('dkim-signature');

  const authAudit = {
    spf: { status: 'NOT DETECTED', details: '' },
    dkim: {
      status: 'NOT DETECTED',
      details: '',
      signatures: [] as Array<{ domain: string; selector: string; algorithm: string; raw: string }>,
    },
    dmarc: { status: 'NOT DETECTED', details: '' },
    arc: { status: 'NOT DETECTED', details: '' },
  };

  if (receivedSpf.length > 0) {
    const s = receivedSpf[0];
    const match = s.match(/^(pass|fail|softfail|neutral|none|temperror|permerror)\b/i);
    authAudit.spf.status = match ? match[1].toUpperCase() : 'RECORDED';
    authAudit.spf.details = s;
  } else if (authResults.length > 0) {
    const s = authResults.join(' ');
    const match = s.match(/\bspf=([a-zA-Z]+)(?:\s*\([^)]*\))?/i);
    if (match) {
      authAudit.spf.status = match[1].toUpperCase();
      authAudit.spf.details = match[0];
    }
  }

  if (dkimSignatures.length > 0) {
    for (const sig of dkimSignatures) {
      const dMatch = sig.match(/\bd=([a-zA-Z0-9.-]+)/);
      const sMatch = sig.match(/\bs=([a-zA-Z0-9.-]+)/);
      const aMatch = sig.match(/\ba=([a-zA-Z0-9.-]+)/);
      authAudit.dkim.signatures.push({
        domain: dMatch ? dMatch[1] : '',
        selector: sMatch ? sMatch[1] : '',
        algorithm: aMatch ? aMatch[1] : '',
        raw: sig,
      });
    }
  }

  if (authResults.length > 0) {
    const s = authResults.join(' ');
    const match = s.match(/\bdkim=([a-zA-Z]+)(?:\s*\([^)]*\))?/i);
    if (match) {
      authAudit.dkim.status = match[1].toUpperCase();
      authAudit.dkim.details = match[0];
    } else if (authAudit.dkim.signatures.length > 0) {
      authAudit.dkim.status = 'SIGNED';
    }
  } else if (authAudit.dkim.signatures.length > 0) {
    authAudit.dkim.status = 'SIGNED';
  }

  if (authResults.length > 0) {
    const s = authResults.join(' ');
    const match = s.match(/\bdmarc=([a-zA-Z]+)(?:\s*\([^)]*\))?/i);
    if (match) {
      authAudit.dmarc.status = match[1].toUpperCase();
      authAudit.dmarc.details = match[0];
    }
  }

  if (arcAuth.length > 0) {
    authAudit.arc.status = 'PRESENT';
    authAudit.arc.details = arcAuth[0];
  }

  // Parse Received: hops
  const receivedRaw = headers
    .filter((h) => h.name.toLowerCase() === 'received')
    .map((h) => h.value);
  const chronologicalHops = [...receivedRaw].reverse();
  const hops: MailHeaderHop[] = [];
  let prevEpoch: number | null = null;

  for (let i = 0; i < chronologicalHops.length; i++) {
    const val = chronologicalHops[i];
    const semi = val.lastIndexOf(';');
    let dateStr = '';
    let body = val;
    let hopDate: Date | null = null;
    if (semi !== -1) {
      dateStr = val.slice(semi + 1).trim();
      body = val.slice(0, semi).trim();
      const p = Date.parse(dateStr);
      if (!Number.isNaN(p)) hopDate = new Date(p);
    }

    const fromMatch = body.match(/\bfrom\s+([^\s;()]+(?:\s*\([^)]*\))?)/i);
    const byMatch = body.match(/\bby\s+([^\s;()]+(?:\s*\([^)]*\))?)/i);
    const withMatch = body.match(/\bwith\s+([A-Za-z0-9_-]+)/i);
    const forMatch = body.match(/\bfor\s+<([^>]+)>/i);
    const idMatch = body.match(/\bid\s+([^\s;]+)/i);
    const tlsMatch = body.match(/\(version=([^\s;)]+)\s+cipher=([^\s;)]+)/i);
    const ipMatch = body.match(/\[([0-9a-fA-F:.]+)\]/);

    const epochMs = hopDate ? hopDate.getTime() : null;
    let delaySeconds = 0;
    if (prevEpoch !== null && epochMs !== null) {
      delaySeconds = Math.max(0, Math.round((epochMs - prevEpoch) / 1000));
    }
    if (epochMs !== null) prevEpoch = epochMs;

    hops.push({
      hop: i + 1,
      from: fromMatch ? fromMatch[1].trim() : 'Unknown origin',
      by: byMatch ? byMatch[1].trim() : 'Unknown receiver',
      protocol: withMatch ? withMatch[1] : 'SMTP',
      forRecipient: forMatch ? forMatch[1] : '',
      id: idMatch ? idMatch[1] : '',
      tls: tlsMatch ? `${tlsMatch[1]} / ${tlsMatch[2]}` : '',
      ip: ipMatch ? ipMatch[1] : '',
      dateString: dateStr,
      timestamp: hopDate ? hopDate.toISOString() : '',
      delaySeconds,
      raw: val,
    });
  }

  return {
    data: {
      ok: true,
      summary: {
        subject: subject || '(No Subject Header)',
        from: from || '(No From Header)',
        to: to || '(No To Header)',
        date: date || '',
        messageId: messageId || '',
        returnPath: returnPath || '',
        deliveredTo: deliveredTo || '',
        totalHops: hops.length,
      },
      auth: authAudit,
      hops,
      allHeaders: headers,
    },
  };
}
