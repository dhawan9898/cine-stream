import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMasterPlaylist } from './flixeoExtractor.ts';

const page = (fhd: boolean) => `<script>
  window.video = {"id":1234,"name":"Inception"};
  window.masterPlaylist = {
      params: {
          'token': 'abc123DEF',
          'expires': '1794400000',
          'asn': '',
      },
      url: 'https://vixsrc.to/playlist/1234?b=1',
  }
  window.canPlayFHD = ${fhd}
</script>`;

test('the stream address is read from the player page', () => {
  assert.equal(parseMasterPlaylist(page(true)), 'https://vixsrc.to/playlist/1234?b=1&token=abc123DEF&expires=1794400000&h=1');
  assert.equal(parseMasterPlaylist(page(false)), 'https://vixsrc.to/playlist/1234?b=1&token=abc123DEF&expires=1794400000');
});

test('a page without a playlist (challenge page, layout change) gives nothing', () => {
  assert.equal(parseMasterPlaylist('<title>Just a moment...</title>'), null);
  assert.equal(parseMasterPlaylist("window.masterPlaylist = { url: 'https://vixsrc.to/playlist/1' }"), null, 'no token');
});
