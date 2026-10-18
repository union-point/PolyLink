import { DataError } from '../data/errors.js';
export function validatePassword(password){
  if(typeof password!=='string'||password.length<8||password.length>128||!/[A-Z]/.test(password)||!/[0-9]/.test(password)||! /[^\w\s]/.test(password))throw new DataError('VALIDATION','Use 8–128 characters, including an uppercase letter, number and symbol.');
}
