// PM2 launcher (CommonJS) for the ESM service, whatever the PM2 version.
import(require('node:path').join(__dirname, 'grantAdmission.mjs')).then(m => m.main()).catch(e => {
  console.error(JSON.stringify({level: 'fatal', msg: 'grant admission failed to start', error: String(e && e.message)}));
  process.exit(1);
});
