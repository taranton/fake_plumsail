# Use an official Node.js runtime as a parent image
FROM node:18-slim

# Install LibreOffice for PDF conversion.
# This is a robust way to handle docx to pdf conversion.
RUN apt-get update && \
    apt-get install -y libreoffice && \
    apt-get clean

# Set the working directory in the container
WORKDIR /usr/src/app

# Copy the template files
COPY template ./template

# Copy the application source code and package files
COPY report-generator-service/package*.json ./report-generator-service/
COPY report-generator-service/index.js ./report-generator-service/

# Set the working directory for the service
WORKDIR /usr/src/app/report-generator-service

# Install app dependencies
# The --prefix argument is not needed here as we are in the correct WORKDIR
RUN npm install

# Bundle app source
# This is already done by the COPY above.

# Expose the port the app runs on
EXPOSE 3000

# Define the command to run the app
CMD [ "npm", "start" ]
