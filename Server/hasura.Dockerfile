#  SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
#
#  SPDX-License-Identifier: Apache-2.0

FROM hasura/graphql-engine:v2.40.3.cli-migrations-v3

# The v2.40 base is no longer rebuilt upstream: take libbrotli1 from the Ubuntu archive only, at least the USN-8956-1 fix.
RUN apt-get update -o Dir::Etc::sourceparts=- \
    && apt-get install -y --no-install-recommends --only-upgrade libbrotli1 \
    && dpkg --compare-versions "$(dpkg-query -W -f='${Version}' libbrotli1)" ge 1.0.9-2ubuntu0.1 \
    && rm -rf /var/lib/apt/lists/*

COPY Server/hasura-metadata/ /hasura-metadata/