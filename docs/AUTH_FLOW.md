# Authentication Flow

## Change Summary
I'd like to add a full authentication flow with login, password, password reset, user name, and email. We won't handle forgot passwords right now and we won't handle any administration (so resetting password for another user). If someone forgets their password I'll manually update the db because it's my db.

## Login

No need to worry about registering new users we'll do that through a script I run on the backend. 

User table will have the username and hashed password and salt and email. Use argon2 with hardcoded parameters (no need for an .env to configure argon2 whatever WASP recomends is good enough for me)

User will put in their username and password on the landing screen. Landing screen should be in the same style as the rest of the application. Short cut keys should obviously be turned off for the login screen since it's not new. 

Users should be left logged in for a long period of time. I'm not too worried about security yet and so the time out should be generous.


## Edit Account Screen
I want an account screen available to the user in the app itself that's accessible by through the shortcut @. They can also click on their user name in the top right. 

On the edit account screen they should be able to edit their username and email. if they want to change password they'll have to input their old password then their new one twice. Password should be required to be 8 characters, 1 cap, 1 lower, 1 symbol, 1 number. 

Screen accepts enter as a short cut for save and also presents a save button. Top right has an X to exit out of the screen. It will also accept escape as an exit without saving but if something's changed it prompts you with a similar styled popup. Should say "Changes will be lost. Continue? Yes (enter) No (esc)" This way double escape doesn't get them out it's escape enter to exit without saving (more intentional, still memorizable)

This screen should be in the same style as the Quick Reference screen. It should have the background fade. 

jk navigation should work and filter the user through the few inputs that are there with "i" actually dropping them into the edit or the user clicking on the area will put them in insert mode. 

Clicking out of the window will act the same as escape/close. If there are unsaved changes it will prompt you.

## User Management

### New User

Make a shell script that is stored in a directory called tools/ that accepts a username, email, and plain text password as inputs (inputs that it prompts the user for) and then inserts that info into the appropriate sections of the database. Make sure it hashes the user's password correctly. The password should not be saved to plain text long term in the script. The script will be checked into source control.

### Reset Password

Make a shell sript in the tools/ directory that accepts a username and new password and then if the username exists it will hash the password and update the appropriate table. If the username does not exist just tell the user that and exit the script. 

## Header Cleanup 

To make things look a little cleaner I want to move the date and time to the left so that you see "tdx_ | HH:MM:SS DoW MMM DD". Then we'll move the stats "11 open - 0 overdue" to the right near the user name (so it's # open |# overdue | USER_NAME). Swap the dot for the pipe symbol so it's consistent across the header. 

The ? help screen should move its close button to be an X in the top right similar to the new screen instead of close being a button at the bottom.
