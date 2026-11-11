import type {HeadersFunction} from "react-router";
import {boundary} from "@shopify/shopify-app-react-router/server";
export const headers:HeadersFunction=args=>boundary.headers(args);
