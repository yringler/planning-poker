import { describe, expect, it } from 'vitest';
import { parseTicketUrl } from './ticket-url';

describe('parseTicketUrl', () => {
  it('URL-01: https link', () => {
    expect(parseTicketUrl('https://jira.example.com/browse/ABC-1')).toEqual({
      href: 'https://jira.example.com/browse/ABC-1',
      host: 'jira.example.com',
    });
  });

  it('URL-02: trims', () => {
    expect(parseTicketUrl('  http://x.io/a  ')).toEqual({ href: 'http://x.io/a', host: 'x.io' });
  });

  it('URL-03: normalises case and adds a path', () => {
    expect(parseTicketUrl('HTTPS://Example.COM')).toEqual({
      href: 'https://example.com/',
      host: 'example.com',
    });
  });

  it('URL-04: host excludes credentials and port', () => {
    expect(parseTicketUrl('https://user:pw@host.io:8443/x?y#z')).toEqual({
      href: 'https://user:pw@host.io:8443/x?y#z',
      host: 'host.io',
    });
  });

  it('URL-05: javascript: in any disguise', () => {
    for (const url of ['javascript:alert(1)', '  JavaScript:alert(1)', 'java\tscript:alert(1)']) {
      expect(parseTicketUrl(url)).toBeNull();
    }
  });

  it('URL-06: other schemes', () => {
    for (const url of [
      'data:text/html,<b>x</b>',
      'file:///etc/passwd',
      'ftp://x.io',
      'mailto:a@b.c',
    ]) {
      expect(parseTicketUrl(url)).toBeNull();
    }
  });

  // PIN: URLs without a scheme are rejected rather than assumed to be https
  it('URL-07: relative and scheme-less URLs', () => {
    expect(parseTicketUrl('/relative')).toBeNull();
    expect(parseTicketUrl('jira.example.com/ABC-1')).toBeNull();
  });

  it('URL-08: blank', () => {
    for (const url of ['', '   ', undefined]) expect(parseTicketUrl(url)).toBeNull();
  });
});
