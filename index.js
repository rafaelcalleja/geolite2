const express = require('express')
const bodyParser = require('body-parser');
const compression = require('compression');
const fetch = require('node-fetch');
const maxmind = require('maxmind');
const fs = require('fs-extra');
const tar = require('tar');
const path = require('path');
const schedule = require('node-schedule');

const resolve = file => path.resolve(__dirname, file);
const app = express();
const downloadUrl = 'http://geolite.maxmind.com/download/geoip/database/GeoLite2-City.tar.gz';
let ipLookup;

function createDbInstance() {
  ipLookup = maxmind.openSync(resolve('./ipDataBase.mmdb'), {
    cache: {
      max: 50000, // Max items in cache, by default it's 6000
    },
    watchForUpdates: true,
  });
}

async function fetchAndProcessFile() {
  const fileName = downloadUrl.split('/').pop();

  try {
    const responseFile = await fetch(downloadUrl);
    const tmpFileStream = fs.createWriteStream(fileName);
    responseFile.body.pipe(tmpFileStream)
      .on('finish', () => {
        console.log(' [x] Compressed DB file downloaded and saved');
        const filePath = resolve(`./${fileName}`);
        tar.extract({
          file: filePath,
          newer: true,
        }).then(() => {
          fs.readdir(resolve(`./`), (err, fileNames) => {
            const extractedFolder = fileNames.find(file => !path.extname(file) && file.toLowerCase().includes('geolite'));
            const extractedFolderPath = resolve(`./${extractedFolder}`);
            fs.readdir(extractedFolderPath, async(err, subFolderFiles) => {
              const ipDatabaseFile = subFolderFiles.find(file => path.extname(file).toLowerCase() === '.mmdb');
              try {
                await fs.move(resolve(`./${extractedFolder}/${ipDatabaseFile}`), resolve(`./ipDataBase.mmdb`), {
                  overwrite: true
                });
                createDbInstance();
                fs.remove(filePath);
                fs.remove(extractedFolderPath);
                console.log(' [x] DB file processed and ready');
              } catch (e) {
                console.error(' [x] Move of processed file failed with error: ', e.message);
                console.info(' [x] Using older file');
              }
            });
          });
        });
      });
  } catch (e) {
    console.error(' [x] Processing of older file failed with error: ', e.message);
  }
}

if (fs.existsSync(resolve('./ipDataBase.mmdb'))) {
  createDbInstance();
}

console.log(' [x] Scheduling the task to fetch the database at 00:00 hrs on every Sunday');
schedule.scheduleJob({
  hour: 00,
  minute: 00,
  dayOfWeek: 0
}, function () {
  console.log('Scheduled task to be executed now');
  fetchAndProcessFile();
});

fetchAndProcessFile();

/*
  Setup the actual server code
 */
app.use(compression());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({
  extended: false
}));

app.all('/', async(req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  try {
    const ip = req.query.ip;

    if (!ip) {
      return res.status(422).json({
        message: 'IP is required',
        status: 'failed'
      });
    }

    const lookupObj = ipLookup.get(ip);
    const responseObj = {
      ip,
    }

    try {
      responseObj.continent = lookupObj.continent.names.en;
      responseObj.country_code = lookupObj.country.iso_code;
      responseObj.country_name = lookupObj.country.names.en;
      responseObj.time_zone = lookupObj.location.time_zone;
      responseObj.latitude = lookupObj.location.latitude;
      responseObj.longitude = lookupObj.location.longitude;
      responseObj.accuracy_radius = lookupObj.location.accuracy_radius;
      responseObj.city = lookupObj.city.names.en;
      responseObj.region_name = lookupObj.subdivisions[0].names.en;
    } catch (err) {}

    res.json(responseObj);
  } catch (err) {
    console.error('Error: ', err.message, err.stack);
    res.status(500).json({
      message: 'unable to process request',
      error: err.toString()
    })
  }
});

console.log(' [x] Starting first time fetch of the IP Database');
app.listen(3000, () => console.log(' [x] IP Resolver app listening on port 3000'))
