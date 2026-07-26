import fs from 'fs';
import yaml from 'yaml';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SCORING_YAML_PATH = path.join(__dirname, '../config/scoring.yaml');

export const SCORING_CONFIG = yaml.parse(fs.readFileSync(SCORING_YAML_PATH, 'utf8'));
