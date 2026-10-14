import { start } from './shared/ui.js';
import { initializeForumList } from './forum/list-page.js';
import { initializeTopicCreation } from './forum/create-page.js';
import { initializeTopic } from './forum/topic-page.js';

const pages = { 'forum.html': initializeForumList, 'new-topic.html': initializeTopicCreation, 'topic.html': initializeTopic };
start(pages[location.pathname.split('/').at(-1)]);
