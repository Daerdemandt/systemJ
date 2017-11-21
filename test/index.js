"use strict"
//--------------------------------- 80 chars -----------------------------------

const _ = require('lodash/fp');

const chai = require('chai');
chai.use(require('chai-as-promised'));
chai.should();

const StatefulObject = require('../index.js');

describe('#dummy test', () => {
	it('does nothing', () => (2+2).should.equal(4));	
});


