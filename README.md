## Finn.no Job Scraper

A TypeScript scraper built with [Crawlee](https://crawlee.dev/) to extract job details from Finn.no using [Cheerio](https://cheerio.js.org/) wrapped into [CheerioCrawler](https://crawlee.dev/api/cheerio-crawler/class/CheerioCrawler).

## Features

- Scrapes job listings from Finn.no based on a search URL
- Extracts comprehensive job details including:
  - Job title
  - Job description
  - Company information
  - Contact details
  - Application URL
  - Location
  - Employment type
  - Salary (if available)
  - Publication date
- Handles pagination to process all search results
- Respects the maximum number of jobs to scrape
- Robust error handling for missing data or website changes
- Optimized for efficiency with concurrent requests

## Input Configuration

The scraper accepts the following inputs:

- `searchUrl` (required): The Finn.no job search URL to start scraping from. 
  - Example: `https://www.finn.no/job/fulltime/search.html?occupation=0.23&occupation=0.22`
  - Default: `https://www.finn.no/job/fulltime/search.html?occupation=0.23&occupation=0.22`
  
- `maxJobs` (optional): Maximum number of jobs to scrape.
  - Default: `100`
  - Minimum: `1`
  - Maximum: `1000`

## Output Data Structure

The scraper outputs an array of job objects with the following structure:

```json
{
  "url": "https://www.finn.no/job/fulltime/ad.html?finnkode=123456789",
  "title": "Software Developer",
  "description": "Arbeidsoppgaver:\n• Utvikling av nye funksjoner\n• Vedlikehold av eksisterende systemer\n• Samarbeid med produktteam\n\nKvalifikasjoner:\n• Erfaring med moderne teknologier\n• God problemløsningsevne\n• Teamplayer med gode kommunikasjonsevner",
  "company": "Example Company AS",
  "contactPersons": [
    {
      "name": "John Doe",
      "role": "HR Manager",
      "phoneNumber": "123 45 678",
      "email": "john.doe@example.com"
    },
    {
      "name": "Jane Smith",
      "role": "Department Head",
      "phoneNumber": "234 56 789",
      "email": "jane.smith@example.com"
    }
  ],
  "applicationUrl": "https://example.com/apply",
  "location": "Oslo",
  "employmentType": "Heltid",
  "salary": "600 000 - 800 000 per år",
  "publicationDate": "Snarest"
}
```

## Key Features

- Comprehensive contact information extraction from multiple sources:
  - Structured contact person elements in the page
  - Unstructured contact information in "Kontaktinformasjon" sections
  - Names, emails, and phone numbers stored as a structured array
  - Intelligent mapping of related contact details
- Clean, formatted job descriptions:
  - HTML-free text with preserved formatting
  - Well-structured content with section headings
  - Lists preserved with bullet points
  - Line breaks and paragraph structure maintained

## How it works

1. The scraper starts at the provided search URL
2. It extracts all job listing URLs from the search results page
3. It visits each job listing URL and extracts the job details
4. It handles pagination to process all search results
5. It respects the maximum number of jobs to scrape
6. The scraped data is stored in the default dataset

## Getting started

To run the actor locally, use the following command:

```bash
apify run
```

## Deploy to Apify

To deploy the scraper to Apify, follow these steps:

1. Log in to Apify:
```bash
apify login
```

2. Deploy your Actor:
```bash
apify push
```

You can find your newly created Actor under [Actors -> My Actors](https://console.apify.com/actors?tab=my).

## Resources

- [Apify SDK for JavaScript documentation](https://docs.apify.com/sdk/js)
- [Crawlee documentation](https://crawlee.dev/)
- [Cheerio documentation](https://cheerio.js.org/)
- [Join Apify's developer community on Discord](https://discord.com/invite/jyEM2PRvMU)
