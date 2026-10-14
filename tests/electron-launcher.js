const { app } = require('electron');
app.setPath('userData', process.env.MARKDOWN_TEST_USER_DATA);
require('../main');
