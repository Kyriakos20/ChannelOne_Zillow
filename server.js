var express = require('express');
var app = express();
var request = require('request');
var bodyParser = require('body-parser');
var async = require("async");
var xml2js = require('xml2js');
var parser = new xml2js.Parser();
var _ = require('lodash');
//Port number
var serverPort = 8080;

app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

app.post('/processZillow', function (req, res) {
    var records = req.body.data;
    var proxy = req.body.proxy;
    var chunkId = req.body.chunkIndex;
    var allData = [];

    async.eachSeries(records, function (data, callback) {
        if (data.address && data.address.street1 && data.address.city && data.address.state) {
            var propertyId = data._id;
            var addressDetails = data.address;
            var address = addressDetails.street1;
            var city = addressDetails.city;
            var state = addressDetails.state;
            var zip = addressDetails.zip;

            console.log('--------- :: processing :: chunkId :: ' + chunkId + ' :: propertyId :: ' + propertyId + ' :: address :: ' + address + ':: ---------');

            var encodeAdd = encodeURI(address);
            //Encode #
            var enAddress = encodeAdd.replace(/#/g, '%23');
            var url = "http://www.zillow.com/webservice/GetSearchResults.htm?zws-id=" + proxy.key + "&address=" + enAddress + "&citystatezip=" + encodeURI(city + ', ' + state + ' ' + zip);
            console.log(url);
            request.post({
                url: url
            }, function (err, resp, body) {
                if (err || resp.statusCode != 200) {
                    console.log('********* :: Error :: chunkId :: ' + chunkId + ' :: address :: '+ address +' :: Error :: ' + err);
                    callback(err);
                } else {
                    parser.parseString(body, function (err, result) {
                        if (err) {
                            allData.push({
                                propertyId: propertyId,
                                address: address,
                                city: city,
                                state: state,
                                zip: zip,
                                lastChecked: Date.now(),
                                status: 'Error',
                                statusMessage: 'Error in Parsing zillow data'
                            });
                            console.log('********* :: Error :: chunkId :: ' + chunkId + ' :: propertyId :: ' + propertyId + ' :: Error in Parsing zillow data :: ' + address);
                            callback();
                        } else {
                            var resultSet = result["SearchResults:searchresults"];
                            if (resultSet
                                && (resultSet.response
                                && resultSet.response.length
                                && resultSet.response[0].results
                                && resultSet.response[0].results.length
                                && resultSet.response[0].results[0].result
                                && resultSet.response[0].results[0].result.length)
                                && !resultSet.message[0]["limit-warning"]) {

                                var findZestimate = _.find(resultSet.response[0].results[0].result, function (data) {
                                    return data.zestimate[0].amount[0]["_"];
                                });

                                if (findZestimate) {
                                    var zpid = findZestimate.zpid[0];
                                    var zestimate = findZestimate.zestimate[0].amount[0]["_"];

                                    allData.push({
                                        propertyId: propertyId,
                                        address: address,
                                        city: city,
                                        state: state,
                                        zip: zip,
                                        status: 'Success',
                                        statusMessage: 'Updated Successfully',
                                        source: 'Zillow',
                                        value: parseInt(zestimate),
                                        link: 'http://www.zillow.com/homedetails/' + parseInt(zpid) + '_zpid/',
                                        zpid: parseInt(zpid),
                                        currentEquity: parseInt(zestimate) - parseInt(data.mortgage.previousValue),
                                        currentEquityPercent: ( parseInt(zestimate) / parseInt(data.mortgage.previousValue) * 100).toFixed(2)
                                    });
                                    console.log('--------- :: Success :: chunkId :: ' + chunkId + ' :: propertyId :: ' + propertyId + ' :: Success:: ' + address);
                                    callback();

                                } else {
                                    allData.push({
                                        propertyId: propertyId,
                                        address: address,
                                        city: city,
                                        state: state,
                                        zip: zip,
                                        status: 'Error',
                                        statusMessage: 'Zestimate value not found'
                                    });
                                    console.log('********* :: Error :: chunkId :: ' + chunkId + ' :: propertyId :: ' + propertyId + ' :: Zestimate value not found :: ' + address);
                                    callback();
                                }

                            } else {
                                var msg = '';
                                if (resultSet && resultSet.message.length && resultSet.message[0].text) {
                                    msg = resultSet.message[0].text;
                                }
                                allData.push({
                                    propertyId: propertyId,
                                    address: address,
                                    city: city,
                                    state: state,
                                    zip: zip,
                                    status: 'Error',
                                    statusMessage: msg
                                });
                                console.log('********* :: Error :: chunkId :: ' + chunkId + ' :: propertyId :: ' + propertyId + ' :: address :: '+ address + ' :: ' + msg);
                                callback();
                            }
                        }

                    });
                }
            });
        } else {
            allData.push({
                propertyId: data._id,
                address: data.address.street1,
                city: data.address.city,
                state: data.address.state,
                zip: data.address.zip,
                status: 'Error',
                statusMessage: 'Invalid address or state or city'
            });
            console.log('********* :: Error :: chunkId :: ' + chunkId + ' :: propertyId :: ' + data._id + ':: address :: '+ data.address.street1 + ' :: city :: ' + data.address.city + ' :: state :: ' + data.address.state);
            callback();
        }
    }, function (err) {
        if(err) {
            console.log('Error in zillow call');
            res.status(400).send(err);
        } else {
            console.log('Done for records');
            res.send(allData);
        }
    });
});

var server = app.listen(serverPort, function () {
    console.log('Server listening at http://' + server.address().port);
});